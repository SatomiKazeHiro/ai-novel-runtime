-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Warning";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "RuntimeProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT,
    "name" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "behavior" TEXT NOT NULL,
    "jailbreak" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkerTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "workerType" TEXT NOT NULL,
    "taskPrompt" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkerTask_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlotArc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stages" TEXT NOT NULL DEFAULT '[]',
    "currentStage" TEXT,
    "nextGoal" TEXT,
    "unresolved" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlotArc_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "runtimeProfileId" TEXT,
    CONSTRAINT "Story_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Story" ("createdAt", "description", "id", "status", "title", "updatedAt") SELECT "createdAt", "description", "id", "status", "title", "updatedAt" FROM "Story";
DROP TABLE "Story";
ALTER TABLE "new_Story" RENAME TO "Story";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlotArc_storyId_status_idx" ON "PlotArc"("storyId", "status");
