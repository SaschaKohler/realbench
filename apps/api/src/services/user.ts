import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function getOrCreateUser(clerkId: string) {
  let user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.clerkId, clerkId),
  });

  if (!user) {
    const clerkUser = await clerk.users.getUser(clerkId);

    const [newUser] = await db
      .insert(users)
      .values({
        clerkId,
        email: clerkUser.emailAddresses[0]?.emailAddress || 'unknown@example.com',
        plan: 'free',
      })
      .returning();

    user = newUser;
  }

  return user;
}
