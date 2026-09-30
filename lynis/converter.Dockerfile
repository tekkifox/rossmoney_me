# lynis-report-converter (d4t4king) renders Lynis' key/value report into a
# single HTML file. Upstream targets debian:stretch-slim, which is archived, so
# this uses a supported base.
#
# Term::ANSIColor ships in core perl-modules-5.36, not a separate package, so the
# `perl` metapackage is all that is needed. See lynis/README.md.
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       perl \
       git \
       ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ARG CONVERTER_REF=master
RUN git clone --depth 1 --branch "$CONVERTER_REF" \
      https://github.com/d4t4king/lynis-report-converter.git /opt/converter \
    && chmod +x /opt/converter/lynis-report-converter.pl \
    && ln -sf /opt/converter/lynis-report-converter.pl /usr/local/bin/lynis-report-converter

RUN mkdir -p /reports && chown -R 1001:1001 /reports
USER 1001:1001

ENTRYPOINT ["lynis-report-converter"]
