import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="max-w-md rounded-[2rem] border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">Page not found</h1>
        <p className="mt-3 text-sm leading-7 text-gray-600">The route does not exist in this MVP.</p>
        <Link href="/dashboard" className="mt-6 inline-flex h-11 items-center rounded-full bg-black px-5 text-sm font-semibold text-white">
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}
