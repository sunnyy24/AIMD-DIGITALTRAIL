import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, ShieldCheck, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/scan", label: "Scan" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/history", label: "History" },
  { to: "/analyze", label: "Quick Analyze" },
  { to: "/technology", label: "Technology" },
  { to: "/about", label: "About" },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-colors duration-300",
        scrolled
          ? "border-border/70 bg-background/70 backdrop-blur-xl"
          : "border-transparent bg-background/30 backdrop-blur-sm",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-3" aria-label="AIMD home">
          <span className="grid size-9 place-items-center rounded-lg border border-primary/40 bg-primary/10 shadow-[0_0_18px_-6px_var(--color-primary)]">
            <ShieldCheck className="size-5 text-primary" />
          </span>
          <span className="leading-none">
            <span className="block font-display text-lg font-bold tracking-tight">AIMD</span>
            <span className="mt-1 block text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              AI Media Intelligence
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/scan">
              New Scan <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-border/70 bg-background/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3" aria-label="Mobile">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "rounded-md px-3 py-2.5 text-sm",
                  pathname === item.to
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
            <Button asChild className="mt-2 sm:hidden">
              <Link to="/scan">
                New Scan <ArrowRight className="size-4" />
              </Link>
            </Button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

