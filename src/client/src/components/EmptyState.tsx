import * as React from "react";
import { cn } from "../lib/utils";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

interface EmptyStateProps {
  icon: React.ElementType;
  // "success" marks an empty state that is good news, such as no failed downloads
  tone?: "default" | "success";
  title: string;
  description?: React.ReactNode;
  // Actions such as a "Clear search" button
  children?: React.ReactNode;
  className?: string;
}

// The app's empty and no-results state, composed from shadcn Empty
export function EmptyState({ icon: Icon, tone = "default", title, description, children, className }: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className={cn(tone === "success" && "text-flexoki-green")} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
