/**
 * DATABASE_URL이 없고 DB_PASSWORD가 있으면 조합해서 설정.
 * .env에 DB_PASSWORD만 두고 쓰려면 시드/앱 로드 시 이 파일을 먼저 import.
 */
try {
    require("dotenv").config();
} catch {
    // dotenv 없으면 무시 (Next/Prisma가 이미 .env 로드한 경우)
}
if (process.env.DB_PASSWORD != null && !process.env.DATABASE_URL) {
    const user = process.env.DB_USER ?? "postgres";
    const host = process.env.DB_HOST ?? "localhost";
    const port = process.env.DB_PORT ?? "5432";
    const db = process.env.DB_NAME ?? "seevar";
    process.env.DATABASE_URL = `postgresql://${user}:${process.env.DB_PASSWORD}@${host}:${port}/${db}?schema=public`;
}
