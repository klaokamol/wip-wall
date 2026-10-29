export type TerminalName = 'ghostty' | 'iterm2'

export type Terminal = {
  name: string
  app: string
  site: string
  open: string
  select: string
  focus: string
  focusBy: 'cwd' | 'tty'
}

export const TERMINALS: Record<TerminalName, Terminal> = {
  ghostty: {
    name: 'Ghostty',
    app: 'Ghostty',
    site: 'ghostty.org',
    focusBy: 'cwd',
    open: `on run argv
tell application "Ghostty"
set cfg to new surface configuration from {initial working directory:(item 1 of argv), initial input:(item 2 of argv)}
if (item 4 of argv) is "split" and (count of windows) > 0 then
set t to selected tab of front window
split (focused terminal of t) direction right with configuration cfg
return id of t
else if (item 4 of argv) is "tab" and (count of windows) > 0 then
set t to new tab in front window with configuration cfg
else
set t to selected tab of (new window with configuration cfg)
end if
try
perform action ("set_tab_title:" & (item 3 of argv)) on (focused terminal of t)
end try
return id of t
end tell
end run`,
    select: `on run argv
tell application "Ghostty"
repeat with wid in (get id of windows)
set w to first window whose id is (contents of wid)
if (get id of tabs of w) contains (item 1 of argv) then
select tab (first tab of w whose id is (item 1 of argv))
activate window w
return "ok"
end if
end repeat
return "gone"
end tell
end run`,
    focus: `on run argv
tell application "Ghostty"
set hits to every terminal whose working directory is (item 1 of argv)
if (count of hits) is 1 then
focus (item 1 of hits)
return "ok"
end if
if (count of hits) is 0 then return "gone"
return "many"
end tell
end run`,
  },
  iterm2: {
    name: 'iTerm2',
    app: 'iTerm2',
    site: 'iterm2.com',
    focusBy: 'tty',
    open: `on run argv
tell application "iTerm2"
if (item 4 of argv) is "split" and (count of windows) > 0 then
tell current session of current window
set s to (split vertically with default profile)
end tell
else if (item 4 of argv) is "tab" and (count of windows) > 0 then
tell current window
set t to (create tab with default profile)
end tell
set s to current session of t
else
set w to (create window with default profile)
set s to current session of w
end if
tell s
set name to (item 3 of argv)
write text ("cd " & quoted form of (item 1 of argv) & " && " & (paragraph 1 of (item 2 of argv)))
if (count of paragraphs of (item 2 of argv)) > 1 then write text (paragraph 2 of (item 2 of argv)) newline NO
end tell
return unique id of s
end tell
end run`,
    select: `on run argv
tell application "iTerm2"
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if (unique id of s) is (item 1 of argv) then
select w
select t
select s
activate
return "ok"
end if
end repeat
end repeat
end repeat
return "gone"
end tell
end run`,
    focus: `on run argv
tell application "iTerm2"
repeat with w in windows
repeat with t in tabs of w
repeat with s in sessions of t
if (tty of s) is (item 1 of argv) then
select w
select t
select s
activate
return "ok"
end if
end repeat
end repeat
end repeat
return "gone"
end tell
end run`,
  },
}

export const terminalOf = (name: string): Terminal => TERMINALS[name.toLowerCase() === 'iterm2' ? 'iterm2' : 'ghostty']
