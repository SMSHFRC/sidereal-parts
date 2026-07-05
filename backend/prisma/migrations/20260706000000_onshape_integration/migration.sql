-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "onshape_did" TEXT,
ADD COLUMN     "onshape_eid" TEXT,
ADD COLUMN     "onshape_part_id" TEXT,
ADD COLUMN     "onshape_wvm" TEXT,
ADD COLUMN     "onshape_wvm_id" TEXT;

-- CreateTable
CREATE TABLE "onshape_accounts" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "onshape_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onshape_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onshape_accounts_user_id_key" ON "onshape_accounts"("user_id");

-- AddForeignKey
ALTER TABLE "onshape_accounts" ADD CONSTRAINT "onshape_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

