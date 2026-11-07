import { cn } from "@/lib/utils";

export function Input(props: React.ComponentProps<"input">) {
  return <input {...props} className={cn("h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring", props.className)} />;
}

export function Textarea(props: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn("min-h-28 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring", props.className)} />;
}

export function Label(props: React.ComponentProps<"label">) {
  return <label {...props} className={cn("text-sm font-medium text-slate-700", props.className)} />;
}

export function Select(props: React.ComponentProps<"select">) {
  return <select {...props} className={cn("h-10 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring", props.className)} />;
}
