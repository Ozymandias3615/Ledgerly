import React, { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";

export default function RefreshButton() {
  const { bumpRefresh } = useAuth();
  const [spinning, setSpinning] = useState(false);

  const handleClick = async () => {
    if (spinning) return;
    setSpinning(true);
    try {
      await bumpRefresh();
      toast.success("Page refreshed");
    } finally {
      setTimeout(() => setSpinning(false), 500);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={spinning}
      data-testid="refresh-page-button"
    >
      <ArrowsClockwise size={16} className={`mr-2 ${spinning ? "animate-spin" : ""}`} />
      Refresh
    </Button>
  );
}
