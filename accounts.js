import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {existsSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {promisify} from 'node:util';

const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(24).toString('base64url');
const sessionAge = 14 * 86400;
const loginPattern = /^[a-z0-9_]{3,24}$/;
const passwordValid = password => typeof password === 'string' && password.length >= 12 && password.length <= 128;
const reject = (status,message) => { throw Object.assign(new Error(message),{status}); };
const publicUser = ({id,login,name,bio,visible,createdAt}) => ({id,login,name,bio,visible,createdAt});

export function accounts(data) {
  const file = join(data,'accounts.json');
  const store = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : {users:[],sessions:{}};
  const users = new Map(store.users.map(user => [user.id,user]));
  const byLogin = new Map(store.users.map(user => [user.login,user]));
  const sessions = new Map(Object.entries(store.sessions));
  const save = () => {
    const now = Date.now();
    for (const [key,session] of sessions) if (session.expires <= now) sessions.delete(key);
    writeFileSync(file + '.tmp',JSON.stringify({users:[...users.values()],sessions:Object.fromEntries(sessions)}),{mode:0o600});
    renameSync(file + '.tmp',file);
  };
  function sessionKey(req) {
    const match = /(?:^|;\s*)brics_session=([\w-]{32})(?:;|$)/.exec(req.headers.cookie ?? '');
    return match && digest(match[1]);
  }
  function cookie(req,value,age) {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    return 'brics_session=' + value + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + (secure ? '; Secure' : '');
  }
  function issue(req,res,user) {
    const value = random();
    sessions.delete(sessionKey(req));
    const current = [...sessions].filter(([,session]) => session.user === user.id);
    for (const [key] of current.slice(0,Math.max(0,current.length-7))) sessions.delete(key);
    sessions.set(digest(value),{user:user.id,expires:Date.now() + sessionAge * 1000});
    save();
    res.setHeader('Set-Cookie',cookie(req,value,sessionAge));
  }
  let hashing = 0;
  let attempts = [];
  async function hash(password,salt) {
    const now = Date.now();
    attempts = attempts.filter(time => now - time < 60000);
    if (hashing >= 2 || attempts.length >= 40) reject(429,'Слишком много попыток. Повторите через минуту.');
    attempts.push(now);
    hashing++;
    try {
      return await derive(password,salt,32,{N:65536,r:8,p:2,maxmem:96*1024*1024});
    } finally {
      hashing--;
    }
  }
  const normalize = login => typeof login === 'string' ? login.trim().toLowerCase() : '';
  const createRecovery = user => {
    const code = random();
    user.recovery = digest(code);
    return code;
  };
  function validateCredentials(login,password) {
    if (!loginPattern.test(login) || !passwordValid(password)) reject(400,'Логин — 3–24 латинских символа, цифры или _. Пароль — 12–128 символов.');
  }
  return {
    current(req) {
      const session = sessions.get(sessionKey(req));
      return session && session.expires > Date.now() ? users.get(session.user) : null;
    },
    list() { return [...users.values()].map(publicUser); },
    profile:publicUser,
    async register(req,res,input) {
      const login = normalize(input.login);
      validateCredentials(login,input.password);
      if (byLogin.has(login)) reject(409,'Этот логин уже занят');
      if (users.size >= 5000) reject(503,'Достигнут лимит аккаунтов');
      const salt = random();
      const password = (await hash(input.password,salt)).toString('hex');
      if (byLogin.has(login)) reject(409,'Этот логин уже занят');
      const user = {id:random(),login,password,salt,name:login,bio:'',visible:false,createdAt:Date.now()};
      const recovery = createRecovery(user);
      users.set(user.id,user);
      byLogin.set(login,user);
      issue(req,res,user);
      return {user:publicUser(user),recovery};
    },
    async login(req,res,input) {
      if (!passwordValid(input.password)) reject(401,'Проверьте логин и пароль');
      const user = byLogin.get(normalize(input.login));
      const saved = user?.password;
      const attempt = await hash(input.password,user?.salt ?? 'unregistered-user');
      if (!user || user.password !== saved || !timingSafeEqual(attempt,Buffer.from(saved,'hex'))) reject(401,'Проверьте логин и пароль');
      issue(req,res,user);
      return {user:publicUser(user)};
    },
    async recover(req,res,input) {
      const login = normalize(input.login);
      validateCredentials(login,input.password);
      const user = byLogin.get(login);
      const code = typeof input.code === 'string' && /^[\w-]{32}$/.test(input.code) ? digest(input.code) : null;
      if (!code || !user || !timingSafeEqual(Buffer.from(code,'hex'),Buffer.from(user.recovery,'hex'))) reject(401,'Проверьте логин и код восстановления');
      const salt = random();
      const password = (await hash(input.password,salt)).toString('hex');
      if (code !== user.recovery) reject(409,'Код уже использован');
      user.salt = salt;
      user.password = password;
      const recovery = createRecovery(user);
      for (const [key,session] of sessions) if (session.user === user.id) sessions.delete(key);
      issue(req,res,user);
      return {user:publicUser(user),recovery};
    },
    logout(req,res) {
      if (sessions.delete(sessionKey(req))) save();
      res.setHeader('Set-Cookie',cookie(req,'',0));
      return {user:null};
    },
    edit(user,input) {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const bio = typeof input.bio === 'string' ? input.bio.trim() : '';
      if (!name || name.length > 28 || bio.length > 200 || typeof input.visible !== 'boolean') reject(400,'Проверьте имя и описание профиля');
      Object.assign(user,{name,bio,visible:input.visible});
      save();
      return publicUser(user);
    }
  };
}
