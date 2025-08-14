from langfuse import observe, get_client
import sys


sys.setrecursionlimit(10000)  # Dangerous and may cause stack overflow


@observe
def add_num(start: int, add: int) -> str:
    """Adds two numbers and returns a greeting.
    Args:
        a (int): The first number to add.
        b (int): The second number to add.
    Returns:
    return "Hello, world!"  # Input/output and timings are automatically captured

        str: A greeting message.
    """
    if (start) >= 4000:
        return f"The sum is {start + add}"
    return add_num(start + add, add)


add_num(2, 1)

# Flush events in short-lived applications
langfuse = get_client()
langfuse.flush()
