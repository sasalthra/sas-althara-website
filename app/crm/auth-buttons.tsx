'use client';
import {signIn, signOut} from 'next-auth/react';
export function LoginButton() { return <button className="primary" onClick={()=>void signIn('google', {callbackUrl: '/crm'})}>الدخول بحساب Google</button>; }
export function LogoutButton() { return <button onClick={()=>void signOut({callbackUrl: '/crm'})}>تسجيل الخروج</button>; }
