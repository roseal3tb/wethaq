import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-sm font-semibold cursor-pointer select-none transition-[background-color,color,box-shadow,border-color,transform] duration-200 ease-out active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200",
  {
    variants: {
      variant: {
        default:
          "bg-navy text-primary-foreground shadow-[inset_0_-2px_0_0_var(--olive-deep)] hover:bg-navy-2 hover:shadow-[inset_0_-2px_0_0_var(--olive)] active:bg-navy",
        olive: "bg-olive-deep text-primary-foreground hover:bg-olive active:bg-olive-deep",
        destructive: "bg-danger text-destructive-foreground hover:bg-danger/90",
        outline:
          "border border-border bg-card text-navy shadow-soft hover:bg-olive-wash hover:border-olive-soft hover:text-olive-deep",
        secondary: "bg-secondary text-navy hover:bg-olive-wash hover:text-olive-deep",
        ghost: "text-ink-2 hover:bg-olive-wash hover:text-olive-deep",
        link: "text-olive-deep underline-offset-4 hover:underline px-0 h-auto",
        sidebar: "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-[10px] px-3 text-xs",
        lg: "h-12 px-6 text-[15px]",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-[10px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    if (asChild) {
      return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>{children}</Comp>;
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
