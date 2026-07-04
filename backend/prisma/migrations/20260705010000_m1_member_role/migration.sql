INSERT INTO "roles" ("name")
VALUES ('member')
ON CONFLICT ("name") DO NOTHING;

UPDATE "users"
SET "role_id" = (SELECT "id" FROM "roles" WHERE "name" = 'member')
WHERE "role_id" IN (
  SELECT "id" FROM "roles" WHERE "name" IN ('designer', 'processor')
);

DELETE FROM "roles"
WHERE "name" IN ('designer', 'processor');
