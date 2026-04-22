# Task 8-a: Auth Components

## Summary
Created Discord-style login and register form components with dark theme styling.

## Files Created
- `/home/z/my-project/src/components/auth/login-form.tsx`
- `/home/z/my-project/src/components/auth/register-form.tsx`

## Key Details
- Both components use `'use client'` directive
- Discord dark theme: `bg-[#313338]` cards, `bg-[#1e1f22]` inputs
- Brand green `#23a559` for primary buttons
- Login: POSTs to `/api/auth/callback/credentials` (NextAuth)
- Register: POSTs to `/api/auth/register`, then auto-login via NextAuth
- Both have loading states, error display, and switch-form links
- Props match the specified interfaces exactly
