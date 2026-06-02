files = [
    "app/api/chat/route.ts",
    "app/api/embed/route.ts",
]

left = bytes.fromhex("e2809c")   # left curly quote
right = bytes.fromhex("e2809d")  # right curly quote
straight = b'"'

for path in files:
    try:
        with open(path, "rb") as f:
            content = f.read()
        count_l = content.count(left)
        count_r = content.count(right)
        if count_l + count_r == 0:
            print(f"{path}: no smart quotes found")
            continue
        fixed = content.replace(left, straight).replace(right, straight)
        with open(path, "wb") as f:
            f.write(fixed)
        print(f"{path}: replaced {count_l} left + {count_r} right curly quotes")
    except FileNotFoundError:
        print(f"{path}: not found, skipping")
