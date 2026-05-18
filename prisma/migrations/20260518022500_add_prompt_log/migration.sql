-- CreateTable
CREATE TABLE "PromptLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "callType" TEXT NOT NULL,
    "aiProviderConfigId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemMessage" TEXT NOT NULL,
    "userMessage" TEXT NOT NULL,
    "responseContent" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedTokens" INTEGER NOT NULL,
    "temperature" REAL,
    "maxTokens" INTEGER,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("aiProviderConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PromptLog_storyId_createdAt_idx" ON "PromptLog"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptLog_callType_createdAt_idx" ON "PromptLog"("callType", "createdAt");
