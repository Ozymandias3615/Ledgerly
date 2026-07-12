import * as React from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PasswordInput = React.forwardRef(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        className="w-full pr-10"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 h-full w-9 grid place-items-center text-slate-400 hover:text-slate-600"
      >
        {visible ? <EyeSlash size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
