import * as functions from 'firebase-functions';
import admin from 'firebase-admin';
import oracledb from 'oracledb';
admin.initializeApp();

export const createUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated','Login required');
  const callerSnap = await admin.firestore().doc(`users/${context.auth.uid}`).get();
  if (callerSnap.data()?.tier !== 'admin') throw new functions.https.HttpsError('permission-denied','Not admin');
  const { email, password, tier='normal', days=60 } = data;
  const { uid } = await admin.auth().createUser({ email, password });
  const limit = tier==='admin'?9999:50;
  const expiresAt = Date.now() + days*24*60*60*1000;
  await admin.firestore().doc(`users/${uid}`).set({
    email, tier, searchLimit: limit, searchesToday:0,
    lastResetDate: new Date().toISOString().split('T')[0],
    expiresAt, createdBy: context.auth.uid, createdAt: new Date().toISOString()
  });
  // Oracle sync — set env in functions config
  let conn;
  try{
    conn = await oracledb.getConnection({
      user: process.env.DB_USER, password: process.env.DB_PASS,
      connectString: process.env.DB_CONN
    });
    await conn.execute(`INSERT INTO dms_quotas (firebase_uid,email,tier,search_limit,searches_today,last_reset) VALUES (:1,:2,:3,:4,0,TRUNC(SYSDATE))`, [uid,email,tier,limit]);
    await conn.commit();
  } finally{ if(conn) await conn.close(); }
  return { uid, email, tier, limit, expiresAt };
});
