import { Nav } from "@/components/nav";

// 仪表盘组布局: 响应式 (PC 侧边栏 / 移动底部 Tab), 主内容区留出导航空间
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Nav />
      {/* PC 侧边栏宽 56 (w-56=14rem), 主内容左移; 移动端不偏移, 底部留 tab 高度 */}
      <main className="md:pl-56">
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:px-8 md:pb-10">
          {children}
        </div>
      </main>
    </div>
  );
}
