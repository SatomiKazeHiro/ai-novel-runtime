-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "fromChapterNumber" REAL,
    "originUid" TEXT,
    "layer" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'event_memory',
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "participants" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Memory_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Memory" ("chapterId", "content", "createdAt", "fromChapterNumber", "id", "importance", "layer", "originUid", "storyId", "tags", "updatedAt") SELECT "chapterId", "content", "createdAt", "fromChapterNumber", "id", "importance", "layer", "originUid", "storyId", "tags", "updatedAt" FROM "Memory";
DROP TABLE "Memory";
ALTER TABLE "new_Memory" RENAME TO "Memory";
CREATE INDEX "Memory_storyId_layer_idx" ON "Memory"("storyId", "layer");
CREATE INDEX "Memory_storyId_category_idx" ON "Memory"("storyId", "category");
CREATE INDEX "Memory_storyId_fromChapterNumber_idx" ON "Memory"("storyId", "fromChapterNumber");
CREATE INDEX "Memory_storyId_originUid_idx" ON "Memory"("storyId", "originUid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
