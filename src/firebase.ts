import { initializeApp, cert, type ServiceAccount } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { readFileSync } from 'fs'
import config from 'config'

const serviceAccountPath = config.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH')
const serviceAccount = JSON.parse(
  readFileSync(serviceAccountPath, 'utf-8')
) as ServiceAccount

const app = initializeApp({
  credential: cert(serviceAccount),
})

const auth = getAuth(app)

export async function verifyToken(authorizationHeader: string | undefined): Promise<DecodedIdToken | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return null
  }

  const idToken = authorizationHeader.slice(7)

  try {
    const decodedToken = await auth.verifyIdToken(idToken)
    return decodedToken
  } catch (error) {
    console.warn('Firebase token verification failed:', error)
    return null
  }
}

export { auth }
