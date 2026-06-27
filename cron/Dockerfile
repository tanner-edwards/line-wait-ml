FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY day_type.py bucketing.py aggregation.py compute_averages.py predict.py build_closure_profiles.py ./

# ENTRYPOINT + CMD split lets Cloud Run Job override the script via --args
# without changing the image. Default runs compute_averages then predict.
ENTRYPOINT ["python"]
CMD ["predict.py"]
