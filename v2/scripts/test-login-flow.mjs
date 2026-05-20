import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
// We cannot easily import Next.js server actions due to "use server" and React internals.
// But we can test the token generation with jose.
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET);

async function run() {
  console.log('Testing JWT signing and verification with AUTH_SECRET:', process.env.AUTH_SECRET.substring(0, 5) + '...');
  
  const token = await new SignJWT({ userId: "test", role: "admin", tenantSlug: "baskent" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("2h")
    .setIssuedAt()
    .sign(SECRET);
    
  console.log('Token generated:', token.substring(0, 20) + '...');
  
  try {
    const { payload } = await jwtVerify(token, SECRET);
    console.log('✅ JWT Verification successful! Payload:', payload.userId);
  } catch(e) {
    console.error('❌ JWT Verification failed:', e);
  }
}
run();
