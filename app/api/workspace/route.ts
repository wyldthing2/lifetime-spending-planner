import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { activity, workspaceMembers, workspaceSnapshots, workspaces } from "@/db/schema";
import { initialSnapshot, type PlannerSnapshot } from "@/lib/planner-data";

export const dynamic = "force-dynamic";

const WORKSPACE_ID = "household";

async function currentUser() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  if (!userId) return null;
  return {
    userId,
    email: requestHeaders.get("oai-authenticated-user-email") ?? "",
  };
}

function isSnapshot(value: unknown): value is PlannerSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlannerSnapshot>;
  return Array.isArray(item.categories) &&
    Array.isArray(item.selectedIds) &&
    Array.isArray(item.savedViews) &&
    typeof item.scenario === "string" &&
    typeof item.yearRange === "string";
}

async function ensureWorkspace() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");

  const db = getDb();
  const workspace = await db.select().from(workspaces).where(eq(workspaces.id, WORKSPACE_ID)).limit(1);
  if (!workspace.length) {
    await db.insert(workspaces).values({ id: WORKSPACE_ID, name: "Household planning" });
    await db.insert(workspaceMembers).values({
      workspaceId: WORKSPACE_ID,
      userId: user.userId,
      email: user.email,
      role: "owner",
    });
  } else {
    const member = await db.select().from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.userId)).limit(1);
    if (!member.length) throw new Error("FORBIDDEN");
  }
  return { db, user };
}

function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return NextResponse.json({ error: "You are not a member of this workspace." }, { status: 403 });
  }
  return NextResponse.json({ error: "Shared storage is not available yet." }, { status: 503 });
}

export async function GET() {
  try {
    const { db } = await ensureWorkspace();
    const snapshot = await db.select().from(workspaceSnapshots)
      .where(eq(workspaceSnapshots.workspaceId, WORKSPACE_ID)).limit(1);
    if (!snapshot.length) {
      await db.insert(workspaceSnapshots).values({
        id: "household-current",
        workspaceId: WORKSPACE_ID,
        version: 1,
        dataJson: JSON.stringify(initialSnapshot),
        updatedBy: "system",
      });
      return NextResponse.json({ version: 1, data: initialSnapshot });
    }
    return NextResponse.json({
      version: snapshot[0].version,
      data: JSON.parse(snapshot[0].dataJson) as PlannerSnapshot,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { db, user } = await ensureWorkspace();
    const body = await request.json() as { version?: number; data?: unknown };
    if (!isSnapshot(body.data)) {
      return NextResponse.json({ error: "Invalid planning snapshot." }, { status: 400 });
    }
    const existing = await db.select().from(workspaceSnapshots)
      .where(eq(workspaceSnapshots.workspaceId, WORKSPACE_ID)).limit(1);
    const currentVersion = existing[0]?.version ?? 0;
    if (typeof body.version === "number" && body.version < currentVersion) {
      return NextResponse.json({ error: "A newer change is already saved.", version: currentVersion }, { status: 409 });
    }
    const nextVersion = currentVersion + 1;
    const payload = JSON.stringify(body.data);
    if (!existing.length) {
      await db.insert(workspaceSnapshots).values({
        id: "household-current",
        workspaceId: WORKSPACE_ID,
        version: nextVersion,
        dataJson: payload,
        updatedBy: user.userId,
      });
    } else {
      await db.update(workspaceSnapshots)
        .set({ version: nextVersion, dataJson: payload, updatedBy: user.userId, updatedAt: new Date().toISOString() })
        .where(eq(workspaceSnapshots.id, "household-current"));
    }
    await db.insert(activity).values({
      workspaceId: WORKSPACE_ID,
      userId: user.userId,
      message: "Updated the shared planning model",
    });
    return NextResponse.json({ version: nextVersion });
  } catch (error) {
    return errorResponse(error);
  }
}

