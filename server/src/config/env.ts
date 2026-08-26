import path from "path";
import dotenv from "dotenv";
// In dev, __dirname is src/config — go up 3 levels to reach project root.
// In prod (compiled), __dirname is dist — go up 2 levels.
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

const e = process.env;

export const env = {
  port: parseInt(e.PORT || "8080", 10),
  nodeEnv: e.NODE_ENV || "development",
  mongoUri: e.MONGODB_URI || "mongodb://localhost:27017/svastha-wabiz",
  jwtSecret: e.JWT_SECRET || "dev-secret-change-me",
  adminEmail: e.ADMIN_EMAIL || "admin@svastha.local",
  adminPassword: e.ADMIN_PASSWORD || "admin123",
  /** Optional shared code that allows self-registration after the first user. */
  signupCode: e.SIGNUP_CODE || "",
  whatsapp: {
    token: e.WHATSAPP_TOKEN || "",
    phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: e.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken: e.WHATSAPP_VERIFY_TOKEN || "svastha-verify",
    appSecret: e.WHATSAPP_APP_SECRET || "",
  },
  ai: {
    anthropicKey: e.ANTHROPIC_API_KEY || "",
    openaiKey: e.OPENAI_API_KEY || "",
  },
};
