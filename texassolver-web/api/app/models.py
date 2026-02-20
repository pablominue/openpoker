from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class BetSizeConfig(BaseModel):
    """Bet sizes for one position/street/action combination."""
    position: str = Field(..., description="ip or oop")
    street: str = Field(..., description="flop, turn, or river")
    action: str = Field(..., description="bet, raise, donk, or allin")
    # Sizes as percentages of pot, e.g. [50, 100]. Empty list means no sizes (used for allin).
    sizes: list[int] = Field(default_factory=list)


class SolveRequest(BaseModel):
    pot: int = Field(..., gt=0, description="Starting pot size in chips")
    effective_stack: int = Field(..., gt=0, description="Effective stack size in chips")
    board: str = Field(
        ...,
        description="Board cards in solver notation, e.g. 'Qs,Jh,2h' or 'Qs,Jh,2h,Td' or 'Qs,Jh,2h,Td,7c'",
    )
    range_ip: str = Field(..., description="In-position hand range in solver notation")
    range_oop: str = Field(..., description="Out-of-position hand range in solver notation")
    bet_sizes: list[BetSizeConfig] = Field(
        default_factory=list,
        description="Bet size configurations per position/street/action",
    )
    allin_threshold: float = Field(
        default=0.67,
        ge=0.0,
        le=1.0,
        description="Stack-to-pot ratio threshold below which allin is offered automatically",
    )
    thread_num: int = Field(default=4, ge=1, le=32)
    accuracy: float = Field(default=0.5, gt=0.0, description="Target exploitability (chips)")
    max_iteration: int = Field(default=200, ge=1)
    print_interval: int = Field(default=10, ge=1)
    use_isomorphism: bool = Field(default=True)
    dump_rounds: int = Field(
        default=2,
        ge=0,
        le=3,
        description="Number of streets to dump (0=root only, 2=flop+turn, 3=all streets)",
    )


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: list[str] = Field(default_factory=list, description="Solver stdout lines so far")
    error: Optional[str] = None


class SolveResponse(BaseModel):
    job_id: str
    status: JobStatus
