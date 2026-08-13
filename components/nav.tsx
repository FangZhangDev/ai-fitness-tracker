"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

// 导航项: 路径 + 名称 + 简短图标 (内联 SVG, 无第三方依赖)
const NAV = [
  { href: "/", label: "概览", icon: HomeIcon },
  { href: "/body", label: "身体", icon: BodyIcon },
  { href: "/meals", label: "饮食", icon: MealIcon },
  { href: "/workouts", label: "训练", icon: DumbIcon },
  { href: "/analysis", label: "分析", icon: SparkIcon },
];

const SECONDARY = [
  { href: "/plan", label: "训练计划" },
  { href: "/data", label: "数据管理" },
  { href: "/profile", label: "个人资料" },
  { href: "/export", label: "数据导出" },
];

export function Nav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* PC 侧边栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-neutral-200 bg-white px-3 py-4 md:flex dark:border-neutral-800 dark:bg-neutral-950">
        <div className="px-2 pb-4 text-base font-semibold tracking-tight">
          💪 AI 健身追踪
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.href} {...item} active={isActive(pathname, item.href)} />
          ))}
          <div className="my-2 border-t border-neutral-200 dark:border-neutral-800" />
          {SECONDARY.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={CogIcon}
              active={isActive(pathname, item.href)}
            />
          ))}
        </nav>
      </aside>

      {/* 移动端顶部栏 */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-2 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="text-sm font-semibold">💪 AI 健身追踪</div>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="btn btn-ghost px-2 py-1"
          aria-label="更多"
        >
          <MenuIcon />
        </button>
      </header>

      {/* 移动端下拉菜单 */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute right-2 top-12 w-44 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
            {SECONDARY.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-md px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 移动端底部 Tab */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-200 bg-white md:hidden dark:border-neutral-800 dark:bg-neutral-950">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active
          ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

// ---- 图标 (内联 SVG, stroke 风格) ----
type IconProps = { className?: string };
function HomeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}
function BodyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="2.5" /><path d="M12 8v8m-4-7 4 2 4-2M9 21l3-5 3 5" />
    </svg>
  );
}
function MealIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M6 13v8M16 3c-1.5 0-3 1.5-3 4s1.5 4 3 4v10" />
    </svg>
  );
}
function DumbIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 6.5 3 10l3.5 3.5M17.5 6.5 21 10l-3.5 3.5M9 7l6 10M9 17l6-10" />
    </svg>
  );
}
function SparkIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}
function CogIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.2-1.3L14 2h-4l-.4 2.2a7 7 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.3l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.2 1.3L10 22h4l.4-2.2a7 7 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5A7 7 0 0 0 19 12Z" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
