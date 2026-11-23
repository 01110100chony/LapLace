use crate::owned;
use std::{
    ffi::OsStr,
    io,
    os::windows::{ffi::OsStrExt, io::OwnedHandle},
    path::Path,
    ptr, thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{DuplicateHandle, DUPLICATE_SAME_ACCESS, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject, TerminateJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        },
        Threading::{
            DeleteProcThreadAttributeList, GetCurrentProcess, InitializeProcThreadAttributeList,
            UpdateProcThreadAttribute, LPPROC_THREAD_ATTRIBUTE_LIST,
        },
    },
};

pub(crate) fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain([0]).collect()
}

pub(crate) struct Attributes(Vec<usize>);

impl Attributes {
    pub(crate) fn new(count: u32) -> io::Result<Self> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), count, 0, &mut bytes) };
        if bytes == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0usize; bytes.div_ceil(size_of::<usize>())];
        if unsafe {
            InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), count, 0, &mut bytes)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(buffer))
    }

    pub(crate) fn as_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }

    // `value` must live until the process has been created and this list deleted.
    pub(crate) unsafe fn add<T>(&mut self, key: u32, value: &T) -> io::Result<()> {
        if UpdateProcThreadAttribute(
            self.as_ptr(),
            0,
            key as usize,
            ptr::from_ref(value).cast(),
            size_of::<T>(),
            ptr::null_mut(),
            ptr::null_mut(),
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.as_ptr()) };
    }
}

pub(crate) fn duplicate_inheritable(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::other("diagnostic stdio unavailable"));
    }
    let process = unsafe { GetCurrentProcess() };
    let mut inheritable = ptr::null_mut();
    if unsafe {
        DuplicateHandle(
            process,
            handle,
            process,
            &mut inheritable,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    owned(inheritable)
}

pub(crate) fn command_line(executable: &Path, args: &[&str]) -> Vec<u16> {
    let mut command = Vec::new();
    let quote = u16::from(b'"');
    let slash = u16::from(b'\\');
    for arg in std::iter::once(executable.as_os_str()).chain(args.iter().map(OsStr::new)) {
        if !command.is_empty() {
            command.push(u16::from(b' '));
        }
        command.push(quote);
        let mut slashes = 0;
        for unit in arg.encode_wide() {
            if unit == slash {
                slashes += 1;
                continue;
            }
            let escaped = if unit == quote {
                slashes * 2 + 1
            } else {
                slashes
            };
            command.extend(std::iter::repeat_n(slash, escaped));
            command.push(unit);
            slashes = 0;
        }
        command.extend(std::iter::repeat_n(slash, slashes * 2));
        command.push(quote);
    }
    command.push(0);
    command
}

pub(crate) fn drain_job(job: HANDLE, exit_code: u32) -> io::Result<()> {
    if unsafe { TerminateJobObject(job, exit_code) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        if unsafe {
            QueryInformationJobObject(
                job,
                JobObjectBasicAccountingInformation,
                ptr::from_mut(&mut info).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                ptr::null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        if info.ActiveProcesses == 0 {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(io::ErrorKind::TimedOut.into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_arguments_keep_spaces_quotes_and_trailing_slashes() {
        let command = command_line(
            Path::new(r"C:\folder name\codex.exe"),
            &[
                "-c",
                r#"cli_auth_credentials_store="file""#,
                r"C:\other folder\",
            ],
        );
        assert_eq!(command.last(), Some(&0));
        assert_eq!(
            String::from_utf16(&command[..command.len() - 1]).unwrap(),
            r#""C:\folder name\codex.exe" "-c" "cli_auth_credentials_store=\"file\"" "C:\other folder\\""#,
        );
    }
}
