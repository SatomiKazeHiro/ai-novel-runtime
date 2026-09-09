-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Score";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "content" TEXT NOT NULL,
    "compiledPrompt" TEXT,
    "params" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'generating',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Draft_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Draft" ("chapterId", "compiledPrompt", "content", "createdAt", "errorMessage", "id", "maxTokens", "params", "status", "storyId", "temperature", "updatedAt", "version") SELECT "chapterId", "compiledPrompt", "content", "createdAt", "errorMessage", "id", "maxTokens", "params", "status", "storyId", "temperature", "updatedAt", "version" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
CREATE UNIQUE INDEX "Draft_id_chapterId_key" ON "Draft"("id", "chapterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
