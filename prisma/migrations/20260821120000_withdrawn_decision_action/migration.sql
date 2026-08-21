-- A published forecast can now be withdrawn (undo). Retracting a figure the
-- client has already been shown is itself a notifiable event, so it needs its
-- own action in the register rather than being silently absent.
ALTER TYPE "DecisionAction" ADD VALUE IF NOT EXISTS 'WITHDRAWN';
