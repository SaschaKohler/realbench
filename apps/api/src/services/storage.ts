import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;

export async function uploadFlamegraph(
  runId: string,
  content: string | Buffer,
  format: 'svg' | 'json' = 'svg'
): Promise<string> {
  const key = `flamegraphs/${runId}.${format}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: typeof content === 'string' ? Buffer.from(content) : content,
    ContentType: format === 'svg' ? 'image/svg+xml' : 'application/json',
  });

  await s3Client.send(command);

  return key;
}

export async function getFlamegraphUrl(key: string, expiresIn = 3600): Promise<string> {
  const getCommand = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
  return getSignedUrl(s3Client, getCommand, { expiresIn });
}

export async function uploadBinary(
  projectId: string,
  commitSha: string,
  content: Buffer
): Promise<string> {
  const key = `binaries/${projectId}/${commitSha}/binary`;

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET_NAME,
      Key: key,
      Body: content,
      ContentType: 'application/octet-stream',
    },
  });

  await upload.done();

  return key;
}

export async function downloadBinary(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);
  const stream = response.Body as Readable;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
