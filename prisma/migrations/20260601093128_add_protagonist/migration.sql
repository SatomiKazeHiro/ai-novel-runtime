/*
  Warnings:

  - You are about to drop the `VersionBranch` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `versionBranchId` on the `Chapter` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `CharacterBranchState` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `GraphEdge` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `GraphNode` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `Memory` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `PlotArc` table. All the data in the column will be lost.
  - You are about to drop the column `versionBranchId` on the `TimelineEvent` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "VersionBranch_storyId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "VersionBranch";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "parentChapterId" TEXT,
    "number" REAL NOT NULL,
    "isSideStory" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "outline" TEXT,
    "content" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sceneLocation" TEXT,
    "sceneMood" TEXT,
    "sceneGoal" TEXT,
    "runtimeProfileId" TEXT,
    "compiledPrompt" TEXT,
    "graphDelta" TEXT,
    "graphSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chapter_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chapter_parentChapterId_fkey" FOREIGN KEY ("parentChapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Chapter_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Chapter" ("compiledPrompt", "content", "createdAt", "graphDelta", "graphSnapshot", "id", "isSideStory", "number", "outline", "parentChapterId", "runtimeProfileId", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt") SELECT "compiledPrompt", "content", "createdAt", "graphDelta", "graphSnapshot", "id", "isSideStory", "number", "outline", "parentChapterId", "runtimeProfileId", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt" FROM "Chapter";
DROP TABLE "Chapter";
ALTER TABLE "new_Chapter" RENAME TO "Chapter";
CREATE INDEX "Chapter_storyId_parentChapterId_idx" ON "Chapter"("storyId", "parentChapterId");
CREATE INDEX "Chapter_storyId_status_idx" ON "Chapter"("storyId", "status");
CREATE TABLE "new_Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protagonist" BOOLEAN NOT NULL DEFAULT false,
    "personality" TEXT NOT NULL DEFAULT '[]',
    "speechStyle" TEXT NOT NULL DEFAULT '[]',
    "identity" TEXT NOT NULL DEFAULT '[]',
    "appearance" TEXT NOT NULL DEFAULT '[]',
    "temperament" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Character" ("appearance", "createdAt", "id", "identity", "name", "personality", "slug", "speechStyle", "storyId", "temperament", "updatedAt") SELECT "appearance", "createdAt", "id", "identity", "name", "personality", "slug", "speechStyle", "storyId", "temperament", "updatedAt" FROM "Character";
DROP TABLE "Character";
ALTER TABLE "new_Character" RENAME TO "Character";
CREATE UNIQUE INDEX "Character_storyId_slug_key" ON "Character"("storyId", "slug");
CREATE TABLE "new_CharacterBranchState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "fromChapterNumber" REAL,
    "status" TEXT NOT NULL DEFAULT '{}',
    "relationships" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterBranchState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CharacterBranchState" ("characterId", "id", "relationships", "status", "updatedAt") SELECT "characterId", "id", "relationships", "status", "updatedAt" FROM "CharacterBranchState";
DROP TABLE "CharacterBranchState";
ALTER TABLE "new_CharacterBranchState" RENAME TO "CharacterBranchState";
CREATE INDEX "CharacterBranchState_characterId_fromChapterNumber_idx" ON "CharacterBranchState"("characterId", "fromChapterNumber");
CREATE TABLE "new_GraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEdge_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GraphEdge" ("createdAt", "fromId", "id", "relation", "storyId", "toId", "weight") SELECT "createdAt", "fromId", "id", "relation", "storyId", "toId", "weight" FROM "GraphEdge";
DROP TABLE "GraphEdge";
ALTER TABLE "new_GraphEdge" RENAME TO "GraphEdge";
CREATE TABLE "new_GraphNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphNode_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GraphNode" ("createdAt", "data", "id", "key", "label", "storyId", "type") SELECT "createdAt", "data", "id", "key", "label", "storyId", "type" FROM "GraphNode";
DROP TABLE "GraphNode";
ALTER TABLE "new_GraphNode" RENAME TO "GraphNode";
CREATE UNIQUE INDEX "GraphNode_storyId_type_key_key" ON "GraphNode"("storyId", "type", "key");
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "fromChapterNumber" REAL,
    "layer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Memory_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Memory" ("chapterId", "content", "createdAt", "id", "importance", "layer", "storyId", "tags", "updatedAt") SELECT "chapterId", "content", "createdAt", "id", "importance", "layer", "storyId", "tags", "updatedAt" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";
CREATE INDEX "Memory_storyId_layer_idx" ON "Memory"("storyId", "layer");
CREATE INDEX "Memory_storyId_fromChapterNumber_idx" ON "Memory"("storyId", "fromChapterNumber");
CREATE TABLE "new_PlotArc" (
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
INSERT INTO "new_PlotArc" ("createdAt", "currentStage", "id", "name", "nextGoal", "progress", "stages", "status", "storyId", "summary", "type", "unresolved", "updatedAt") SELECT "createdAt", "currentStage", "id", "name", "nextGoal", "progress", "stages", "status", "storyId", "summary", "type", "unresolved", "updatedAt" FROM "PlotArc";
DROP TABLE "PlotArc";
ALTER TABLE "new_PlotArc" RENAME TO "PlotArc";
CREATE INDEX "PlotArc_storyId_status_idx" ON "PlotArc"("storyId", "status");
CREATE TABLE "new_TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "fromChapterNumber" REAL,
    "day" INTEGER NOT NULL,
    "events" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimelineEvent_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TimelineEvent" ("createdAt", "day", "events", "id", "storyId", "updatedAt") SELECT "createdAt", "day", "events", "id", "storyId", "updatedAt" FROM "TimelineEvent";
DROP TABLE "TimelineEvent";
ALTER TABLE "new_TimelineEvent" RENAME TO "TimelineEvent";
CREATE UNIQUE INDEX "TimelineEvent_storyId_day_key" ON "TimelineEvent"("storyId", "day");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
