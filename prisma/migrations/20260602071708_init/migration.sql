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
    "aiProviderConfigId" TEXT,
    "compiledPrompt" TEXT,
    "graphDelta" TEXT,
    "graphSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chapter_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chapter_parentChapterId_fkey" FOREIGN KEY ("parentChapterId") REFERENCES "Chapter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Chapter_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Chapter_aiProviderConfigId_fkey" FOREIGN KEY ("aiProviderConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Chapter" ("aiProviderConfigId", "compiledPrompt", "content", "createdAt", "graphDelta", "graphSnapshot", "id", "isSideStory", "number", "outline", "parentChapterId", "runtimeProfileId", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt") SELECT "aiProviderConfigId", "compiledPrompt", "content", "createdAt", "graphDelta", "graphSnapshot", "id", "isSideStory", "number", "outline", "parentChapterId", "runtimeProfileId", "sceneGoal", "sceneLocation", "sceneMood", "status", "storyId", "summary", "title", "updatedAt" FROM "Chapter";
DROP TABLE "Chapter";
ALTER TABLE "new_Chapter" RENAME TO "Chapter";
CREATE INDEX "Chapter_storyId_parentChapterId_idx" ON "Chapter"("storyId", "parentChapterId");
CREATE INDEX "Chapter_storyId_status_idx" ON "Chapter"("storyId", "status");
CREATE TABLE "new_Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "aiProviderConfigId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "runtimeProfileId" TEXT,
    CONSTRAINT "Story_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Story_aiProviderConfigId_fkey" FOREIGN KEY ("aiProviderConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Story" ("aiProviderConfigId", "createdAt", "description", "id", "runtimeProfileId", "status", "title", "updatedAt") SELECT "aiProviderConfigId", "createdAt", "description", "id", "runtimeProfileId", "status", "title", "updatedAt" FROM "Story";
DROP TABLE "Story";
ALTER TABLE "new_Story" RENAME TO "Story";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
