# Seat Planner — Backend

Express + Sequelize (MySQL) REST API providing authentication and role-based
access control.

## Structure

```
src/
├── config/        env loading + Sequelize connection
├── constants/     roles & permission matrix (single source of truth)
├── models/        Sequelize models (User)
├── middleware/    authenticate, authorize, validate, error handler
├── services/      business logic (auth, users, token, email)
├── controllers/   thin HTTP layer
├── validators/    express-validator rule sets
├── routes/        route definitions
├── seeders/       createSuperAdmin bootstrap
├── app.js         express app wiring
└── server.js      DB connect + listen
```

## Scripts

| Command                    | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Start with nodemon (auto-reload)         |
| `npm start`                | Start the server                         |
| `npm run seed:superadmin`  | Create/promote the bootstrap super admin |

## Notes

- Passwords are hashed with bcrypt; only `passwordHash` is stored.
- JWT access tokens carry `{ sub: userId, role }`.
- Email verification & password reset share a 6-digit OTP with a configurable TTL.
- `sequelize.sync({ alter: true })` keeps schema in sync in development. Use
  proper migrations before production.
