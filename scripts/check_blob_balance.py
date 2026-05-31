import sys, os
s = open('dist/ai.js','r',encoding='utf8').read()
start = s.find("const code = `")
if start==-1:
    print("no start"); sys.exit(2)
blobIdx = s.find("const blob = new Blob([code]", start)
if blobIdx==-1:
    print("no blob"); sys.exit(2)
close = s.rfind("`", 0, blobIdx)
if close==-1:
    print("no close"); sys.exit(2)
inner = s[start+len("const code = `"):close]
if not os.path.exists('tmp'):
    os.makedirs('tmp')
open('tmp/inline_worker_blob.js','w',encoding='utf8').write(inner)
print('wrote', len(inner))
# check balance
pairs = {'(':')','[':']','{':'}'}
closing = {v:k for k,v in pairs.items()}
stack=[]
line=1; col=1
errors=[]
for ch in inner:
    if ch == '\n':
        line+=1; col=1; continue
    if ch in pairs:
        stack.append((ch,line,col))
    elif ch in pairs.values():
        if not stack:
            errors.append((line,col,'unmatched closing '+ch))
        else:
            top = stack.pop()
            if pairs[top[0]] != ch:
                errors.append((line,col,'mismatch: {} expected {} but got {}'.format(top[0], pairs[top[0]], ch)))
    col+=1
print('stack len', len(stack))
if stack:
    print('unclosed items (top last):')
    for item in stack[-10:]:
        print(item)
if errors:
    for e in errors[:50]:
        print('ERR', e)
else:
    print('No balance errors')
