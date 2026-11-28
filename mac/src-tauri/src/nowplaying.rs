// Media keys, the Now Playing widget in Control Center, AirPods and Touch Bar controls for the in-app player.
// Enabled only while something plays, so Music and other apps get the keys back afterwards.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSDictionary, NSNumber, NSString};
use objc2_media_player::{
    MPChangePlaybackPositionCommandEvent, MPMediaItemPropertyPlaybackDuration, MPMediaItemPropertyTitle, MPNowPlayingInfoCenter,
    MPNowPlayingInfoPropertyElapsedPlaybackTime, MPNowPlayingInfoPropertyPlaybackRate, MPNowPlayingPlaybackState, MPRemoteCommand,
    MPRemoteCommandCenter, MPRemoteCommandEvent, MPRemoteCommandHandlerStatus, MPSkipIntervalCommandEvent,
};

use crate::player;

fn on(command: &MPRemoteCommand, f: impl Fn(&MPRemoteCommandEvent) + 'static) {
    let block = RcBlock::new(move |ev: NonNull<MPRemoteCommandEvent>| -> MPRemoteCommandHandlerStatus {
        f(unsafe { ev.as_ref() });
        MPRemoteCommandHandlerStatus::Success
    });
    unsafe {
        command.addTargetWithHandler(&block);
        command.setEnabled(false);
    }
}

/// Register the handlers. Main thread, once.
pub fn setup() {
    unsafe {
        let cc = MPRemoteCommandCenter::sharedCommandCenter();
        on(&cc.togglePlayPauseCommand(), |_| player::cmd(&["cycle", "pause"]));
        on(&cc.playCommand(), |_| player::cmd(&["set", "pause", "no"]));
        on(&cc.pauseCommand(), |_| player::cmd(&["set", "pause", "yes"]));
        let fwd = cc.skipForwardCommand();
        let back = cc.skipBackwardCommand();
        let ten = objc2_foundation::NSArray::from_retained_slice(&[NSNumber::new_f64(10.0)]);
        fwd.setPreferredIntervals(&ten);
        back.setPreferredIntervals(&ten);
        let secs = |ev: &MPRemoteCommandEvent| {
            let ev: &MPSkipIntervalCommandEvent = &*(ev as *const MPRemoteCommandEvent as *const MPSkipIntervalCommandEvent);
            let i = ev.interval();
            if i > 0.0 { i } else { 10.0 }
        };
        on(&fwd, move |ev| player::cmd(&["seek", &format!("{}", secs(ev)), "relative"]));
        on(&back, move |ev| player::cmd(&["seek", &format!("-{}", secs(ev)), "relative"]));
        on(&cc.changePlaybackPositionCommand(), |ev| {
            let ev: &MPChangePlaybackPositionCommandEvent = &*(ev as *const MPRemoteCommandEvent as *const MPChangePlaybackPositionCommandEvent);
            player::cmd(&["seek", &format!("{:.2}", ev.positionTime()), "absolute"]);
        });
    }
}

fn set_enabled(on: bool) {
    unsafe {
        let cc = MPRemoteCommandCenter::sharedCommandCenter();
        for c in [
            cc.togglePlayPauseCommand(),
            cc.playCommand(),
            cc.pauseCommand(),
            cc.changePlaybackPositionCommand().into_super(),
            cc.skipForwardCommand().into_super(),
            cc.skipBackwardCommand().into_super(),
        ] {
            c.setEnabled(on);
        }
    }
}

/// What is playing, for Control Center and the media keys. Main thread.
pub fn update(title: &str, duration: f64, position: f64, paused: bool) {
    set_enabled(true);
    unsafe {
        let center = MPNowPlayingInfoCenter::defaultCenter();
        let t = NSString::from_str(title);
        let (d, p, r) = (NSNumber::new_f64(duration.max(0.0)), NSNumber::new_f64(position.max(0.0)), NSNumber::new_f64(if paused { 0.0 } else { 1.0 }));
        let keys: [&NSString; 4] = [MPMediaItemPropertyTitle, MPMediaItemPropertyPlaybackDuration, MPNowPlayingInfoPropertyElapsedPlaybackTime, MPNowPlayingInfoPropertyPlaybackRate];
        let vals: [&AnyObject; 4] = [&t, &d, &p, &r];
        let info = NSDictionary::from_slices(&keys, &vals);
        center.setNowPlayingInfo(Some(&info));
        center.setPlaybackState(if paused { MPNowPlayingPlaybackState::Paused } else { MPNowPlayingPlaybackState::Playing });
    }
}

/// Nothing plays any more: hand the media keys back. Main thread.
pub fn clear() {
    unsafe {
        let center = MPNowPlayingInfoCenter::defaultCenter();
        center.setNowPlayingInfo(None);
        center.setPlaybackState(MPNowPlayingPlaybackState::Stopped);
    }
    set_enabled(false);
}
