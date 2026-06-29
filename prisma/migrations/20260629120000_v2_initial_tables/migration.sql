-- CreateTable
CREATE TABLE "V2Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isProtagonist" BOOLEAN NOT NULL DEFAULT false,
    "identity" TEXT NOT NULL DEFAULT '[]',
    "appearance" TEXT NOT NULL DEFAULT '[]',
    "temperament" TEXT NOT NULL DEFAULT '[]',
    "personality" TEXT NOT NULL DEFAULT '[]',
    "speechStyle" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "V2CharacterSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "identity" TEXT NOT NULL DEFAULT '[]',
    "appearance" TEXT NOT NULL DEFAULT '[]',
    "temperament" TEXT NOT NULL DEFAULT '[]',
    "personality" TEXT NOT NULL DEFAULT '[]',
    "speechStyle" TEXT NOT NULL DEFAULT '[]',
    "relationships" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "V2CharacterSnapshot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "V2Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "V2Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 4,
    "participants" TEXT,
    "originChapterNumber" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "V2MemoryMergeLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "inputMemoryIds" TEXT NOT NULL,
    "outputMemoryIds" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "V2PlotArc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isMainline" BOOLEAN NOT NULL DEFAULT false,
    "firstChapterNumber" INTEGER NOT NULL,
    "lastUpdateChapterNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "V2PlotArcDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "plotArcId" TEXT,
    "chapterId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "isMainline" BOOLEAN NOT NULL,
    "mergeInfo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "V2Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "number" REAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "analysisId" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "V2Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'generating',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "V2Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "V2Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "V2TimelineAnchor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "position" REAL NOT NULL,
    "label" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "V2TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anchorId" TEXT NOT NULL,
    "chapterNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    CONSTRAINT "V2TimelineEvent_anchorId_fkey" FOREIGN KEY ("anchorId") REFERENCES "V2TimelineAnchor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "V2Character_storyId_slug_key" ON "V2Character"("storyId", "slug");

-- CreateIndex
CREATE INDEX "V2Character_storyId_idx" ON "V2Character"("storyId");

-- CreateIndex
CREATE INDEX "V2CharacterSnapshot_characterId_chapterNumber_idx" ON "V2CharacterSnapshot"("characterId", "chapterNumber");

-- CreateIndex
CREATE INDEX "V2Memory_storyId_type_idx" ON "V2Memory"("storyId", "type");

-- CreateIndex
CREATE INDEX "V2Memory_storyId_category_idx" ON "V2Memory"("storyId", "category");

-- CreateIndex
CREATE INDEX "V2Memory_storyId_isActive_idx" ON "V2Memory"("storyId", "isActive");

-- CreateIndex
CREATE INDEX "V2MemoryMergeLog_storyId_chapterNumber_idx" ON "V2MemoryMergeLog"("storyId", "chapterNumber");

-- CreateIndex
CREATE INDEX "V2PlotArc_storyId_status_idx" ON "V2PlotArc"("storyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "V2Chapter_storyId_number_key" ON "V2Chapter"("storyId", "number");

-- CreateIndex
CREATE INDEX "V2Chapter_storyId_status_idx" ON "V2Chapter"("storyId", "status");

-- CreateIndex
CREATE INDEX "V2Draft_chapterId_idx" ON "V2Draft"("chapterId");

-- CreateIndex
CREATE INDEX "V2TimelineAnchor_storyId_idx" ON "V2TimelineAnchor"("storyId");

-- CreateIndex
CREATE INDEX "V2TimelineEvent_anchorId_idx" ON "V2TimelineEvent"("anchorId");
