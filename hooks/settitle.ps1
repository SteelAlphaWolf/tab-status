# Sets the Windows Terminal tab title of the Claude Code session whose process id is $TargetPid.
# Keeps Claude's own chat name and swaps the status in front of it.
# Emoji cross the command line as hex code points (-Icon 1F7E2) so nothing gets mangled.
#   -Icon   status icon, hex code point
#   -Extra  short ASCII text after the icon ("1h05m", "8m"), optional
#   -Full   context-window percent; when set, adds a brick + "NN%" (chat nearly full), optional
param([int]$TargetPid, [string]$Icon, [string]$Extra = "", [string]$Full = "")

Add-Type -Namespace TabStatus -Name Con -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(int pid);
[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetConsoleTitleW(string t);
[DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern int GetConsoleTitleW(System.Text.StringBuilder b, int size);
'@

[TabStatus.Con]::FreeConsole() | Out-Null
if (-not [TabStatus.Con]::AttachConsole($TargetPid)) { "attach failed"; exit 1 }

$sb = New-Object System.Text.StringBuilder 1024
[TabStatus.Con]::GetConsoleTitleW($sb, 1024) | Out-Null
$current = $sb.ToString()

# Strip leading icons / spinner glyphs and our own stamps ("1h05m", "8m", "85%"), keep the chat name.
$name = $current
do {
  $before = $name
  $name = $name -replace '^[^\p{L}\p{N}]+', ''
  $name = $name -replace '^(\d+h\d{2}m|\d+m|\d+%)(?=\s|$)', ''
} while ($name -ne $before)
if (-not $name) { $name = "Claude Code" }

function Get-Glyph([string]$hex) { [char]::ConvertFromUtf32([Convert]::ToInt32($hex, 16)) }

$parts = @(Get-Glyph $Icon)
if ($Extra) { $parts += $Extra }
if ($Full) { $parts += ((Get-Glyph '1F9F1') + $Full + '%') }
$parts += $name
$title = $parts -join ' '

if ($title -ne $current) { [TabStatus.Con]::SetConsoleTitleW($title) | Out-Null }
[TabStatus.Con]::FreeConsole() | Out-Null
"ok"
