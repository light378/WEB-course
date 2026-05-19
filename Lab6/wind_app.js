require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const csrf = require('csurf');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const cookieParser = require('cookie-parser');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "https://cdn.jsdelivr.net"]
    }
  }
}));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
};
app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());

const users = [];

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  const user = users.find(u => u.email === email);
  if (!user) return done(null, false, { message: 'Невірний email' });
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return done(null, false, { message: 'Невірний пароль' });
  return done(null, user);
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = users.find(u => u.id === id);
  done(null, user);
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Не автентифіковано' });
}
function hasRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Не автентифіковано' });
    if (roles.includes(req.user.role)) return next();
    res.status(403).json({ error: 'Недостатньо прав' });
  };
}

const csrfProtection = csrf({ cookie: true });

// ЗМЕНШЕНО ЛІМІТ ДЛЯ ТЕСТУВАННЯ:
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: 'Забагато спроб' });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 1000 });

let turbines = [
  { id: 1, name: 'WTG-01', power_kw: 2200, wind_speed: 7.5, bladeAngle: 12, status: 'normal' },
  { id: 2, name: 'WTG-02', power_kw: 2100, wind_speed: 6.2, bladeAngle: 10, status: 'warning' }
];
let alerts = [];

app.post('/api/register',
  authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/\d/),
  body('name').notEmpty().trim().escape(),
  body('role').isIn(['technician', 'engineer', 'manager']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password, name, role } = req.body;
    if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email вже існує' });
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = { id: Date.now().toString(), email, passwordHash, name, role };
    users.push(newUser);
    res.json({ message: 'Користувач зареєстрований', user: { id: newUser.id, email, name, role } });
  }
);

app.post('/api/login',
  authLimiter,
  csrfProtection,
  (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: info.message });
      req.logIn(user, (err) => {
        if (err) return next(err);
        res.json({ message: 'Вхід успішний', user: { id: user.id, email: user.email, name: user.name, role: user.role } });
      });
    })(req, res, next);
  }
);

app.post('/api/logout', isAuthenticated, (req, res) => {
  req.logout(() => res.json({ message: 'Вихід виконано' }));
});

app.get('/api/turbines', isAuthenticated, (req, res) => {
  res.json(turbines);
});

app.post('/api/turbines/:id/settings',
  isAuthenticated,
  hasRole('engineer', 'manager'),
  csrfProtection,
  body('bladeAngle').isInt({ min: 0, max: 30 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const turbine = turbines.find(t => t.id == req.params.id);
    if (!turbine) return res.status(404).json({ error: 'Турбіну не знайдено' });
    turbine.bladeAngle = req.body.bladeAngle;
    res.json({ message: 'Налаштування оновлено', turbine });
  }
);

app.get('/api/reports', isAuthenticated, hasRole('manager'), (req, res) => {
  const totalPower = turbines.reduce((sum, t) => sum + t.power_kw, 0);
  res.json({ totalPowerMW: (totalPower / 1000).toFixed(2), turbinesCount: turbines.length, alertsCount: alerts.length });
});

app.post('/api/alerts',
  isAuthenticated,
  hasRole('technician'),
  csrfProtection,
  body('turbineId').isInt(),
  body('message').notEmpty().trim().escape(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const newAlert = { id: Date.now(), turbineId: req.body.turbineId, message: req.body.message, createdAt: new Date() };
    alerts.push(newAlert);
    res.json({ message: 'Сповіщення надіслано', alert: newAlert });
  }
);

app.get('/api/csrf-token', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/wind_dashboard.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));