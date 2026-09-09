-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN "cumulativeGraphGeneratedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlotArc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'active',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stages" TEXT NOT NULL DEFAULT '[]',
    "currentStage" TEXT,
    "nextGoal" TEXT,
    "unresolved" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "closedReason" TEXT,
    "closedTargetArcId" TEXT,
    "lastTouchedChapter" INTEGER,
    "similarToExistingIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlotArc_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlotArc" ("closedReason", "closedTargetArcId", "createdAt", "currentStage", "id", "lastTouchedChapter", "name", "nextGoal", "progress", "similarToExistingIds", "stages", "status", "storyId", "summary", "type", "unresolved", "updatedAt") SELECT "closedReason", "closedTargetArcId", "createdAt", "currentStage", "id", "lastTouchedChapter", "name", "nextGoal", "progress", "similarToExistingIds", "stages", "status", "storyId", "summary", "type", "unresolved", "updatedAt" FROM "PlotArc";
DROP TABLE "PlotArc";
ALTER TABLE "new_PlotArc" RENAME TO "PlotArc";
CREATE INDEX "PlotArc_storyId_status_idx" ON "PlotArc"("storyId", "status");
CREATE INDEX "PlotArc_storyId_status_lastTouchedChapter_idx" ON "PlotArc"("storyId", "status", "lastTouchedChapter");
CREATE TABLE "new_TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "fromChapterNumber" REAL,
    "position" REAL NOT NULL,
    "events" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimelineEvent_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TimelineEvent" ("createdAt", "events", "fromChapterNumber", "id", "position", "storyId", "updatedAt") SELECT "createdAt", "events", "fromChapterNumber", "id", "position", "storyId", "updatedAt" FROM "TimelineEvent";
DROP TABLE "TimelineEvent";
ALTER TABLE "new_TimelineEvent" RENAME TO "TimelineEvent";
CREATE UNIQUE INDEX "TimelineEvent_storyId_position_key" ON "TimelineEvent"("storyId", "position");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
