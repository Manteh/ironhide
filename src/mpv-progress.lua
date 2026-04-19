-- IronHide mpv progress tracker
-- Saves playback position periodically via file (fallback for non-IPC mode)

local last_pos = 0
local last_dur = 0

local function save_progress()
    local path = os.getenv("IRONHIDE_PROGRESS_FILE")
    if not path then return end

    local pos = last_pos
    local duration = last_dur
    local percent = duration > 0 and (pos / duration * 100) or 0

    local f = io.open(path, "w")
    if f then
        f:write(string.format('{"position":%.1f,"duration":%.1f,"percent":%.1f}\n', pos, duration, percent))
        f:close()
    end
end

mp.observe_property("time-pos", "number", function(_, val)
    if val then last_pos = val end
end)

mp.observe_property("duration", "number", function(_, val)
    if val then last_dur = val end
end)

mp.add_periodic_timer(5, save_progress)
mp.register_event("shutdown", save_progress)
