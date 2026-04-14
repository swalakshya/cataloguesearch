import contextvars
import logging
import os
from logging.handlers import RotatingFileHandler

VERBOSE_LEVEL_NUM = 15
logging.addLevelName(VERBOSE_LEVEL_NUM, "VERBOSE")

METRICS_LEVEL_NUM = 25
logging.addLevelName(METRICS_LEVEL_NUM, "METRICS")

_query_id_var: contextvars.ContextVar[str] = contextvars.ContextVar('query_id', default='')


def set_query_id(qid: str) -> None:
    _query_id_var.set(qid)


class _QueryIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        qid = _query_id_var.get()
        record.query_id = f' [{qid}]' if qid else ''
        return True

def verbose(self, message, *args, **kws):
    if self.isEnabledFor(VERBOSE_LEVEL_NUM):
        # Call self.log with stacklevel=2. This tells the logging module to go
        # two frames up the call stack (past this function) to find the
        # original call site for getting the correct filename and line number.
        self.log(VERBOSE_LEVEL_NUM, message, *args, stacklevel=2, **kws)

def metrics(self, message, *args, **kws):
    if self.isEnabledFor(METRICS_LEVEL_NUM):
        self.log(METRICS_LEVEL_NUM, message, *args, stacklevel=2, **kws)

logging.Logger.verbose = verbose
logging.Logger.metrics = metrics

def setup_logging(logs_dir="logs",
                  console_level=VERBOSE_LEVEL_NUM,
                  file_level=logging.DEBUG,
                  console_only=True):
    if not os.path.exists(logs_dir):
        os.makedirs(logs_dir)

    # Added %(filename)s to show the source file and %(funcName)s for the function.
    # Replaced %(name)s with the more informative filename.
    log_format = '[%(asctime)s %(levelname)s - %(filename)s:%(funcName)s : %(lineno)d]%(query_id)s %(message)s'
    date_format = '%Y-%m-%d %H:%M:%S'

    root_logger = logging.getLogger()
    root_logger.setLevel(min(console_level, file_level, VERBOSE_LEVEL_NUM))

    # Clear existing handlers
    if root_logger.hasHandlers():
        root_logger.handlers.clear()

    qid_filter = _QueryIdFilter()

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(console_level)
    console_handler.setFormatter(logging.Formatter(log_format, date_format))
    console_handler.addFilter(qid_filter)
    root_logger.addHandler(console_handler)

    # Suppress noisy OpenSearch client logs
    logging.getLogger('opensearch').setLevel(logging.WARNING)
    logging.getLogger('opensearchpy').setLevel(logging.WARNING)
    logging.getLogger('elasticsearch').setLevel(logging.WARNING)

    if not console_only:
        # Set up three file handlers: one for INFO+, one for VERBOSE+, one for METRICS
        info_log_path = os.path.join(logs_dir, "info.log")
        verbose_log_path = os.path.join(logs_dir, "verbose.log")
        metrics_log_path = os.path.join(logs_dir, "metrics.log")

        info_handler = RotatingFileHandler(
            info_log_path, maxBytes=5*1024*1024, backupCount=5
        )
        info_handler.setLevel(logging.INFO)
        info_handler.setFormatter(logging.Formatter(log_format, date_format))
        info_handler.addFilter(qid_filter)
        root_logger.addHandler(info_handler)

        verbose_handler = RotatingFileHandler(
            verbose_log_path, maxBytes=5*1024*1024, backupCount=5
        )
        verbose_handler.setLevel(VERBOSE_LEVEL_NUM)
        verbose_handler.setFormatter(logging.Formatter(log_format, date_format))
        verbose_handler.addFilter(qid_filter)
        root_logger.addHandler(verbose_handler)

        # Metrics handler with CSV-friendly format
        metrics_handler = RotatingFileHandler(
            metrics_log_path, maxBytes=10*1024*1024, backupCount=10
        )
        metrics_handler.setLevel(METRICS_LEVEL_NUM)
        metrics_format = '%(asctime)s,%(message)s'
        metrics_handler.setFormatter(logging.Formatter(metrics_format, date_format))
        root_logger.addHandler(metrics_handler)