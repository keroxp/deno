// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
use crate::flags::Flags;
use log::Level;
use regex::{Regex, RegexBuilder};
use std::env;
use std::fs;
use std::fs::File;
use std::io::Error;
use std::io::ErrorKind;
use std::io::Write;
#[cfg(not(windows))]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use url::Url;

lazy_static! {
    static ref EXEC_NAME_RE: Regex = RegexBuilder::new(
        r"^[a-z][\w-]*$"
    ).case_insensitive(true).build().unwrap();
    // Regular expression to test disk driver letter. eg "C:\\User\username\path\to"
    static ref DRIVE_LETTER_REG: Regex = RegexBuilder::new(
        r"^[c-z]:"
    ).case_insensitive(true).build().unwrap();
}

pub fn is_remote_url(module_url: &str) -> bool {
  module_url.starts_with("http://") || module_url.starts_with("https://")
}

fn validate_exec_name(exec_name: &str) -> Result<(), Error> {
  if EXEC_NAME_RE.is_match(exec_name) {
    Ok(())
  } else {
    Err(Error::new(
      ErrorKind::Other,
      format!("Invalid module name: {}", exec_name),
    ))
  }
}

#[cfg(windows)]
/// On Windows if user is using Powershell .cmd extension is need to run the
/// installed module.
/// Generate batch script to satisfy that.
fn generate_executable_file(
  file_path: PathBuf,
  args: Vec<String>,
) -> Result<(), Error> {
  let args: Vec<String> = args.iter().map(|c| format!("\"{}\"", c)).collect();
  let template = format!(
    "% generated by deno install %\ndeno.exe {} %*\n",
    args.join(" ")
  );
  let mut file = File::create(&file_path)?;
  file.write_all(template.as_bytes())?;
  Ok(())
}

#[cfg(not(windows))]
fn generate_executable_file(
  file_path: PathBuf,
  args: Vec<String>,
) -> Result<(), Error> {
  let args: Vec<String> = args.iter().map(|c| format!("\"{}\"", c)).collect();
  let template = format!(
    r#"#!/bin/sh
# generated by deno install
deno {} "$@"
"#,
    args.join(" "),
  );
  let mut file = File::create(&file_path)?;
  file.write_all(template.as_bytes())?;
  let _metadata = fs::metadata(&file_path)?;
  let mut permissions = _metadata.permissions();
  permissions.set_mode(0o755);
  fs::set_permissions(&file_path, permissions)?;
  Ok(())
}

fn get_installer_dir() -> Result<PathBuf, Error> {
  // In Windows's Powershell $HOME environmental variable maybe null
  // if so use $USERPROFILE instead.
  let home = env::var("HOME")
    .map(String::into)
    .unwrap_or_else(|_| "".to_string());
  let user_profile = env::var("USERPROFILE")
    .map(String::into)
    .unwrap_or_else(|_| "".to_string());

  if home.is_empty() && user_profile.is_empty() {
    return Err(Error::new(ErrorKind::Other, "$HOME is not defined"));
  }

  let home_path = if !home.is_empty() { home } else { user_profile };

  let mut home_path = PathBuf::from(home_path);
  home_path.push(".deno");
  home_path.push("bin");
  Ok(home_path)
}

pub fn install(
  flags: Flags,
  installation_dir: Option<PathBuf>,
  exec_name: &str,
  module_url: &str,
  args: Vec<String>,
  force: bool,
) -> Result<(), Error> {
  let installation_dir = if let Some(dir) = installation_dir {
    dir.canonicalize()?
  } else {
    get_installer_dir()?
  };

  // ensure directory exists
  if let Ok(metadata) = fs::metadata(&installation_dir) {
    if !metadata.is_dir() {
      return Err(Error::new(
        ErrorKind::Other,
        "Installation path is not a directory",
      ));
    }
  } else {
    fs::create_dir_all(&installation_dir)?;
  };

  // Check if module_url is remote
  let module_url = if is_remote_url(module_url) {
    Url::parse(module_url).expect("Should be valid url")
  } else {
    let module_path = PathBuf::from(module_url);
    let module_path = if module_path.is_absolute() {
      module_path
    } else {
      let cwd = env::current_dir().unwrap();
      cwd.join(module_path)
    };
    Url::from_file_path(module_path).expect("Path should be absolute")
  };

  validate_exec_name(exec_name)?;
  let mut file_path = installation_dir.join(exec_name);

  if cfg!(windows) {
    file_path = file_path.with_extension("cmd");
  }

  if file_path.exists() && !force {
    return Err(Error::new(
      ErrorKind::Other,
      "Existing installation found. Aborting (Use -f to overwrite)",
    ));
  };

  let mut executable_args = vec!["run".to_string()];
  executable_args.extend_from_slice(&flags.to_permission_args());
  if let Some(ca_file) = flags.ca_file {
    executable_args.push("--cert".to_string());
    executable_args.push(ca_file)
  }
  if let Some(log_level) = flags.log_level {
    if log_level == Level::Error {
      executable_args.push("--quiet".to_string());
    } else {
      executable_args.push("--log-level".to_string());
      let log_level = match log_level {
        Level::Debug => "debug",
        Level::Info => "info",
        _ => {
          return Err(Error::new(
            ErrorKind::Other,
            format!("invalid log level {}", log_level),
          ))
        }
      };
      executable_args.push(log_level.to_string());
    }
  }
  executable_args.push(module_url.to_string());
  executable_args.extend_from_slice(&args);

  generate_executable_file(file_path.to_owned(), executable_args)?;

  println!("✅ Successfully installed {}", exec_name);
  println!("{}", file_path.to_string_lossy());
  let installation_dir_str = installation_dir.to_string_lossy();

  if !is_in_path(&installation_dir) {
    println!("ℹ️  Add {} to PATH", installation_dir_str);
    if cfg!(windows) {
      println!("    set PATH=%PATH%;{}", installation_dir_str);
    } else {
      println!("    export PATH=\"{}:$PATH\"", installation_dir_str);
    }
  }

  Ok(())
}

fn is_in_path(dir: &PathBuf) -> bool {
  if let Some(paths) = env::var_os("PATH") {
    for p in env::split_paths(&paths) {
      if *dir == p {
        return true;
      }
    }
  }
  false
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  #[test]
  fn test_is_remote_url() {
    assert!(is_remote_url("https://deno.land/std/http/file_server.ts"));
    assert!(is_remote_url("http://deno.land/std/http/file_server.ts"));
    assert!(!is_remote_url("file:///dev/deno_std/http/file_server.ts"));
    assert!(!is_remote_url("./dev/deno_std/http/file_server.ts"));
  }

  #[test]
  fn install_basic() {
    let temp_dir = TempDir::new().expect("tempdir fail");
    let temp_dir_str = temp_dir.path().to_string_lossy().to_string();
    // NOTE: this test overrides environmental variables
    // don't add other tests in this file that mess with "HOME" and "USEPROFILE"
    // otherwise transient failures are possible because tests are run in parallel.
    // It means that other test can override env vars when this test is running.
    let original_home = env::var_os("HOME");
    let original_user_profile = env::var_os("HOME");
    env::set_var("HOME", &temp_dir_str);
    env::set_var("USERPROFILE", &temp_dir_str);

    install(
      Flags::default(),
      None,
      "echo_test",
      "http://localhost:4545/cli/tests/echo_server.ts",
      vec![],
      false,
    )
    .expect("Install failed");

    let mut file_path = temp_dir.path().join(".deno/bin/echo_test");
    if cfg!(windows) {
      file_path = file_path.with_extension("cmd");
    }

    assert!(file_path.exists());

    let content = fs::read_to_string(file_path).unwrap();
    // It's annoying when shell scripts don't have NL at the end.
    assert_eq!(content.chars().last().unwrap(), '\n');

    assert!(content
      .contains(r#""run" "http://localhost:4545/cli/tests/echo_server.ts""#));
    if let Some(home) = original_home {
      env::set_var("HOME", home);
    }
    if let Some(user_profile) = original_user_profile {
      env::set_var("USERPROFILE", user_profile);
    }
  }

  #[test]
  fn install_custom_dir() {
    let temp_dir = TempDir::new().expect("tempdir fail");
    install(
      Flags::default(),
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      "http://localhost:4545/cli/tests/echo_server.ts",
      vec![],
      false,
    )
    .expect("Install failed");

    let mut file_path = temp_dir.path().join("echo_test");
    if cfg!(windows) {
      file_path = file_path.with_extension("cmd");
    }

    assert!(file_path.exists());
    let content = fs::read_to_string(file_path).unwrap();
    assert!(content
      .contains(r#""run" "http://localhost:4545/cli/tests/echo_server.ts""#));
  }

  #[test]
  fn install_with_flags() {
    let temp_dir = TempDir::new().expect("tempdir fail");

    install(
      Flags {
        allow_net: true,
        allow_read: true,
        log_level: Some(Level::Error),
        ..Flags::default()
      },
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      "http://localhost:4545/cli/tests/echo_server.ts",
      vec!["--foobar".to_string()],
      false,
    )
    .expect("Install failed");

    let mut file_path = temp_dir.path().join("echo_test");
    if cfg!(windows) {
      file_path = file_path.with_extension("cmd");
    }

    assert!(file_path.exists());
    let content = fs::read_to_string(file_path).unwrap();
    assert!(content.contains(r#""run" "--allow-read" "--allow-net" "--quiet" "http://localhost:4545/cli/tests/echo_server.ts" "--foobar""#));
  }

  #[test]
  fn install_local_module() {
    let temp_dir = TempDir::new().expect("tempdir fail");
    let local_module = env::current_dir().unwrap().join("echo_server.ts");
    let local_module_url = Url::from_file_path(&local_module).unwrap();
    let local_module_str = local_module.to_string_lossy();

    install(
      Flags::default(),
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      &local_module_str,
      vec![],
      false,
    )
    .expect("Install failed");

    let mut file_path = temp_dir.path().join("echo_test");
    if cfg!(windows) {
      file_path = file_path.with_extension("cmd");
    }

    assert!(file_path.exists());
    let content = fs::read_to_string(file_path).unwrap();
    assert!(content.contains(&local_module_url.to_string()));
  }

  #[test]
  fn install_force() {
    let temp_dir = TempDir::new().expect("tempdir fail");

    install(
      Flags::default(),
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      "http://localhost:4545/cli/tests/echo_server.ts",
      vec![],
      false,
    )
    .expect("Install failed");

    let mut file_path = temp_dir.path().join("echo_test");
    if cfg!(windows) {
      file_path = file_path.with_extension("cmd");
    }
    assert!(file_path.exists());

    // No force. Install failed.
    let no_force_result = install(
      Flags::default(),
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      "http://localhost:4545/cli/tests/cat.ts", // using a different URL
      vec![],
      false,
    );
    assert!(no_force_result.is_err());
    assert!(no_force_result
      .unwrap_err()
      .to_string()
      .contains("Existing installation found"));
    // Assert not modified
    let file_content = fs::read_to_string(&file_path).unwrap();
    assert!(file_content.contains("echo_server.ts"));

    // Force. Install success.
    let force_result = install(
      Flags::default(),
      Some(temp_dir.path().to_path_buf()),
      "echo_test",
      "http://localhost:4545/cli/tests/cat.ts", // using a different URL
      vec![],
      true,
    );
    assert!(force_result.is_ok());
    // Assert modified
    let file_content_2 = fs::read_to_string(&file_path).unwrap();
    assert!(file_content_2.contains("cat.ts"));
  }
}
