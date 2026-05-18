-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT,
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "model" TEXT NOT NULL,
    "contextLength" INTEGER NOT NULL DEFAULT 64000,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AiProviderConfig" ("apiKey", "baseUrl", "createdAt", "id", "isDefault", "maxTokens", "model", "name", "storyId", "temperature", "updatedAt") SELECT "apiKey", "baseUrl", "createdAt", "id", "isDefault", "maxTokens", "model", "name", "storyId", "temperature", "updatedAt" FROM "AiProviderConfig";
DROP TABLE "AiProviderConfig";
ALTER TABLE "new_AiProviderConfig" RENAME TO "AiProviderConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
