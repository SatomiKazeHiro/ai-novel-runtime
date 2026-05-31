-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "runtimeProfileId" TEXT,
    CONSTRAINT "Story_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VersionBranch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "forkFromChapterId" TEXT,
    "forkFromVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VersionBranch_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "parentChapterId" TEXT,
    "versionBranchId" TEXT NOT NULL,
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
    CONSTRAINT "Chapter_runtimeProfileId_fkey" FOREIGN KEY ("runtimeProfileId") REFERENCES "RuntimeProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Chapter_versionBranchId_fkey" FOREIGN KEY ("versionBranchId") REFERENCES "VersionBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL DEFAULT '[]',
    "speechStyle" TEXT NOT NULL DEFAULT '[]',
    "identity" TEXT NOT NULL DEFAULT '[]',
    "appearance" TEXT NOT NULL DEFAULT '[]',
    "temperament" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CharacterBranchState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "versionBranchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '{}',
    "relationships" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CharacterBranchState_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoreItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoreItem_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "versionBranchId" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "importance" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Memory_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "versionBranchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphNode_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "versionBranchId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GraphEdge_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "GraphNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "versionBranchId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "events" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimelineEvent_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "content" TEXT NOT NULL,
    "compiledPrompt" TEXT,
    "params" TEXT NOT NULL DEFAULT '{}',
    "score" TEXT,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Draft_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Draft_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PromptConfig_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "versionBranchId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "draftId" TEXT,
    "styleSimilarity" REAL,
    "outlineAdherence" REAL,
    "sceneMatch" REAL,
    "profileConsistency" REAL,
    "proseQuality" REAL,
    "emotionalTension" REAL,
    "pacing" REAL,
    "totalScore" REAL,
    "comment" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Score_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Score_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiProviderConfig" (
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
    CONSTRAINT "AiProviderConfig_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    CONSTRAINT "PromptLog_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PromptLog_aiProviderConfigId_fkey" FOREIGN KEY ("aiProviderConfigId") REFERENCES "AiProviderConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VersionBranch_storyId_idx" ON "VersionBranch"("storyId");

-- CreateIndex
CREATE INDEX "Chapter_storyId_parentChapterId_idx" ON "Chapter"("storyId", "parentChapterId");

-- CreateIndex
CREATE INDEX "Chapter_storyId_status_idx" ON "Chapter"("storyId", "status");

-- CreateIndex
CREATE INDEX "Chapter_versionBranchId_idx" ON "Chapter"("versionBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_storyId_slug_key" ON "Character"("storyId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterBranchState_characterId_versionBranchId_key" ON "CharacterBranchState"("characterId", "versionBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "LoreItem_storyId_category_slug_key" ON "LoreItem"("storyId", "category", "slug");

-- CreateIndex
CREATE INDEX "Memory_storyId_versionBranchId_layer_idx" ON "Memory"("storyId", "versionBranchId", "layer");

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_storyId_versionBranchId_type_key_key" ON "GraphNode"("storyId", "versionBranchId", "type", "key");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineEvent_storyId_versionBranchId_day_key" ON "TimelineEvent"("storyId", "versionBranchId", "day");

-- CreateIndex
CREATE INDEX "PlotArc_storyId_versionBranchId_status_idx" ON "PlotArc"("storyId", "versionBranchId", "status");

-- CreateIndex
CREATE INDEX "PromptLog_storyId_createdAt_idx" ON "PromptLog"("storyId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptLog_callType_createdAt_idx" ON "PromptLog"("callType", "createdAt");

