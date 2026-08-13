import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <div className="text-3xl">🔍</div>
      <h1 className="text-lg font-semibold">页面不存在</h1>
      <Link href="/" className="btn btn-primary">返回首页</Link>
    </div>
  );
}
