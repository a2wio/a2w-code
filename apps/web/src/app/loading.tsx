import { AppLogo } from "@/components/AppLogo";

export default function Loading() {
  return (
    <div className="grid h-full w-full place-items-center bg-[#f7f7f4]">
      <AppLogo decorative className="a2w-loader-mark h-20 w-20" roundedClassName="rounded-[1.45rem]" />
    </div>
  );
}
