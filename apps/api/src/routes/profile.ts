import { Hono } from 'hono';
import type { Variables } from '../types.js';
import { db } from '../db/index.js';
import { profilingRuns } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOrCreateUser } from '../services/user.js';
import { ProfileRequestSchema } from '@realbench/shared';
import { enqueueProfilingJob } from '../workers/queue.js';
import { uploadBinary } from '../services/storage.js';
import { analyzeBinary, getDebugBuildInstructions } from '../services/binary-analyzer.js';
import { and, eq, gte, count, inArray } from 'drizzle-orm';

const FREE_PLAN_RUNS_PER_MONTH = 5;
const FREE_PLAN_BINARY_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

const app = new Hono<{ Variables: Variables }>();

app.get('/quota', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');
  const user = await getOrCreateUser(clerkId);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const userProjects = await db.query.projects.findMany({
    where: (projects, { eq }) => eq(projects.userId, user.id),
    columns: { id: true },
  });
  const userProjectIds = userProjects.map((p) => p.id);

  const [{ used }] = await db
    .select({ used: count() })
    .from(profilingRuns)
    .where(
      userProjectIds.length > 0
        ? and(
            inArray(profilingRuns.projectId, userProjectIds),
            gte(profilingRuns.createdAt, startOfMonth)
          )
        : eq(profilingRuns.projectId, '')
    );

  const isPro = user.plan === 'pro' || user.plan === 'admin';

  return c.json({
    data: {
      plan: user.plan,
      used: Number(used),
      limit: isPro ? null : FREE_PLAN_RUNS_PER_MONTH,
      remaining: isPro ? null : Math.max(0, FREE_PLAN_RUNS_PER_MONTH - Number(used)),
      resetsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    },
  });
});

app.post('/', authMiddleware, async (c) => {
  const clerkId = c.get('clerkId');

  const formData = await c.req.formData();
  const binaryFile = formData.get('binary') as File;

  if (!binaryFile) {
    return c.json({ error: 'Binary file is required' }, 400);
  }

  // Parse profiling options from form data
  const profilingOptionsJson = formData.get('profilingOptions') as string;
  let profilingOptions = undefined;
  if (profilingOptionsJson) {
    try {
      profilingOptions = JSON.parse(profilingOptionsJson);
    } catch (e) {
      return c.json({ error: 'Invalid profilingOptions JSON' }, 400);
    }
  }

  const prNumberRaw = formData.get('githubPrNumber');
  const parsed = ProfileRequestSchema.safeParse({
    projectId: formData.get('projectId'),
    commitSha: formData.get('commitSha'),
    branch: formData.get('branch'),
    buildType: formData.get('buildType'),
    binaryName: formData.get('binaryName') || binaryFile.name,
    profilingOptions,
    githubRepo: formData.get('githubRepo') || undefined,
    githubPrNumber: prNumberRaw ? parseInt(prNumberRaw as string, 10) : undefined,
    githubToken: formData.get('githubToken') || undefined,
  });

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;

  const binaryBuffer = Buffer.from(await binaryFile.arrayBuffer());

  const user = await getOrCreateUser(clerkId);

  if (user.plan === 'free') {
    if (binaryBuffer.length > FREE_PLAN_BINARY_SIZE_BYTES) {
      return c.json(
        { error: `Free plan allows binaries up to ${FREE_PLAN_BINARY_SIZE_BYTES / 1024 / 1024} MB. Upgrade to Pro for up to 500 MB.` },
        413
      );
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const userProjects = await db.query.projects.findMany({
      where: (projects, { eq }) => eq(projects.userId, user.id),
      columns: { id: true },
    });
    const userProjectIds = userProjects.map((p) => p.id);

    const [{ runsThisMonth }] = await db
      .select({ runsThisMonth: count() })
      .from(profilingRuns)
      .where(
        userProjectIds.length > 0
          ? and(
              inArray(profilingRuns.projectId, userProjectIds),
              gte(profilingRuns.createdAt, startOfMonth)
            )
          : eq(profilingRuns.projectId, '')
      );

    if (runsThisMonth >= FREE_PLAN_RUNS_PER_MONTH) {
      return c.json(
        { error: `Free plan limit reached (${FREE_PLAN_RUNS_PER_MONTH} runs/month). Upgrade to Pro for unlimited profiling.` },
        429
      );
    }
  }

  const project = await db.query.projects.findFirst({
    where: (projects, { eq }) => eq(projects.id, data.projectId),
  });

  if (!project || project.userId !== user.id) {
    return c.json({ error: 'Project not found or access denied' }, 404);
  }

  // Analyze binary for debug symbols
  console.log(`Analyzing binary ${binaryFile.name} (${binaryBuffer.length} bytes)...`);
  const analysis = await analyzeBinary(binaryBuffer, binaryFile.name);
  console.log(`Binary analysis: debug=${analysis.hasDebugSymbols}, lineInfo=${analysis.hasLineInfo}, buildType=${analysis.buildType}`);

  const binaryKey = await uploadBinary(data.projectId, data.commitSha, binaryBuffer);

  const [run] = await db
    .insert(profilingRuns)
    .values({
      projectId: data.projectId,
      commitSha: data.commitSha,
      branch: data.branch,
      buildType: analysis.buildType !== 'unknown'
        ? analysis.buildType
        : data.buildType === 'auto' ? 'release' : data.buildType,
      status: 'pending',
      githubRepo: data.githubRepo ?? null,
      githubPrNumber: data.githubPrNumber ?? null,
    })
    .returning();

  await enqueueProfilingJob({
    runId: run.id,
    projectId: data.projectId,
    binaryKey,
    commitSha: data.commitSha,
    branch: data.branch,
    buildType: run.buildType,
    // P0/P1/P1b: Pass profiling options
    profilingOptions: data.profilingOptions,
    // GitHub Actions integration
    githubRepo: data.githubRepo,
    githubPrNumber: data.githubPrNumber,
    githubToken: data.githubToken,
  });

  const response: Record<string, unknown> = {
    runId: run.id,
    status: 'pending',
    message: 'Profiling job enqueued',
    binaryAnalysis: {
      hasDebugSymbols: analysis.hasDebugSymbols,
      hasLineInfo: analysis.hasLineInfo,
      detectedBuildType: analysis.buildType,
      symbolCount: analysis.symbolCount,
    },
  };

  // Include warnings and build instructions if debug symbols are missing
  if (analysis.warnings.length > 0) {
    response.warnings = analysis.warnings;
    response.buildInstructions = getDebugBuildInstructions(project.language);
  }

  return c.json(response);
});

export default app;
