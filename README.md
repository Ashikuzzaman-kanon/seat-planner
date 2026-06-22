# Train Seat Planner

A role-based application for managing train coach seat plans.

This repository currently implements the **authentication and role-permission**
foundation. The seat-plan builder/viewer and approval workflow are scaffolded
and ready to be wired up once the plan UI details are finalized.

## Roles & permissions

Hierarchy: `user` < `planner` < `admin` < `super_admin`

| Capability                | user | planner | admin | super_admin |
| ------------------------- | :--: | :-----: | :---: | :---------: |
| View approved plans       |  ✅  |   ✅    |  ✅   |     ✅      |
| Create / update / delete plans |    |   ✅    |  ✅   |     ✅      |
| Approve plans             |      |         |  ✅   |     ✅      |
| View users                |      |         |  ✅   |     ✅      |
| Change user roles         |      |         |       |     ✅      |

- A **planner's** new/edited plan goes to *pending* and must be approved by an
  admin or super admin before users can see it.
- Plans created by an **admin / super_admin** are auto-approved (enforced when
  the plan module lands).
- The role/permission matrix is defined once in
  [`backend/src/constants/roles.js`](backend/src/constants/roles.js) and mirrored
  on the frontend in [`frontend/src/constants/roles.js`](frontend/src/constants/roles.js).

## Layout

```
seat-planner/
├── backend/    Express + Sequelize (MySQL) REST API
└── frontend/   Next.js (App Router) + PrimeReact
```

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env          # then edit DB + JWT + SMTP values
npm install
npm run seed:superadmin       # creates the first super admin from .env
npm run dev                   # http://localhost:4000/api
```

Requires a MySQL database matching `DB_NAME` (default `seat_planner`).
If `EMAIL_HOST` is left blank, verification/reset codes are printed to the
backend console instead of emailed — convenient for local testing.

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local    # NEXT_PUBLIC_API_BASE_URL defaults to localhost:4000/api
npm install
npm run dev                   # http://localhost:3000
```

## API summary

| Method | Path                          | Access            |
| ------ | ----------------------------- | ----------------- |
| POST   | `/api/auth/register`          | public            |
| POST   | `/api/auth/verify-email`      | public            |
| POST   | `/api/auth/resend-verification` | public          |
| POST   | `/api/auth/login`             | public            |
| POST   | `/api/auth/forgot-password`   | public            |
| POST   | `/api/auth/reset-password`    | public            |
| GET    | `/api/auth/me`                | authenticated     |
| GET    | `/api/users`                  | `user:view`       |
| GET    | `/api/users/:id`              | `user:view`       |
| PATCH  | `/api/users/:id/role`         | `user:manage_roles` |
| GET    | `/api/meta/roles`             | public            |

## Frontend pages

- `/register`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`
- `/dashboard` — role-aware home
- `/dashboard/users` — **super admin** role management
- `/dashboard/approvals` — **admin/super admin** approval queue (scaffold)
- `/dashboard/plans` — seat plans (scaffold)
