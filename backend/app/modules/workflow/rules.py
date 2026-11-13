"""The eight P0 transitions; ticket creation is an initialization, not a transition."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Transition:
    from_status: str
    to_status: str
    actor: str
    event_type: str


TRANSITIONS = {
    "APPROVE": Transition("SUBMITTED", "PENDING_ASSIGNMENT", "ADMIN", "TICKET_APPROVED"),
    "REJECT": Transition("SUBMITTED", "REJECTED", "ADMIN", "TICKET_REJECTED"),
    "CANCEL": Transition("SUBMITTED", "CANCELLED", "REPORTER", "TICKET_CANCELLED"),
    "ASSIGN": Transition("PENDING_ASSIGNMENT", "ASSIGNED", "ADMIN", "TICKET_ASSIGNED"),
    "START": Transition("ASSIGNED", "IN_PROGRESS", "TECHNICIAN", "WORK_STARTED"),
    "RESOLVE": Transition("IN_PROGRESS", "PENDING_CONFIRMATION", "TECHNICIAN", "RESOLUTION_SUBMITTED"),
    "CONFIRM": Transition("PENDING_CONFIRMATION", "CLOSED", "REPORTER", "TICKET_CLOSED"),
    "REWORK": Transition("PENDING_CONFIRMATION", "IN_PROGRESS", "REPORTER", "REWORK_REQUESTED"),
}

TERMINAL_STATUSES = frozenset({"CLOSED", "REJECTED", "CANCELLED"})
