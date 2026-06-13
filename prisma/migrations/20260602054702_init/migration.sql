-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "model" TEXT NOT NULL,
    "contextLength" INTEGER NOT NULL DEFAULT 64000,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiProviderConfig_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AiProviderConfig" ("apiKey", "baseUrl", "contextLength", "createdAt", "id", "isDefault", "maxTokens", "model", "name", "remarks", "storyId", "temperature", "updatedAt") SELECT "apiKey", "baseUrl", "contextLength", "createdAt", "id", "isDefault", "maxTokens", "model", "name", "remarks", "storyId", "temperature", "updatedAt" FROM "AiProviderConfig";
DROP TABLE "AiProviderConfig";
ALTER TABLE "new_AiProviderConfig" RENAME TO "AiProviderConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
